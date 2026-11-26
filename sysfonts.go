package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
)

// SystemFontInfo is one installed font discovered on disk. The family and
// style come from the font's own "name" table (the same source the
// Local Font Access API uses), so the frontend can group and style them
// exactly like native FontData. `File` is the absolute path to the font
// file; the /api/system-font-bytes endpoint serves its bytes.
type SystemFontInfo struct {
	Family string `json:"family"`
	Style  string `json:"style"`
	File   string `json:"file"`
}

var (
	sysFontsOnce   sync.Once
	sysFontsCache  []SystemFontInfo
	sysFontsErr    error
	sysFontRootsOnce sync.Once
	sysFontRoots   []string
)

// systemFontRoots returns the directories that may contain installed fonts.
// The list is intentionally conservative: only well-known per-user and
// system locations are scanned, and the byte endpoint refuses anything
// outside them.
func systemFontRoots() []string {
	sysFontRootsOnce.Do(func() {
		seen := map[string]bool{}
		add := func(dir string) {
			if dir == "" {
				return
			}
			if abs, err := filepath.Abs(dir); err == nil {
				dir = abs
			}
			if seen[dir] {
				return
			}
			seen[dir] = true
			sysFontRoots = append(sysFontRoots, dir)
		}
		switch runtime.GOOS {
		case "windows":
			if windir := os.Getenv("WINDIR"); windir != "" {
				add(filepath.Join(windir, "Fonts"))
			}
			if local := os.Getenv("LOCALAPPDATA"); local != "" {
				add(filepath.Join(local, "Microsoft", "Windows", "Fonts"))
			}
		case "darwin":
			add("/System/Library/Fonts")
			add("/Library/Fonts")
			if home, _ := os.UserHomeDir(); home != "" {
				add(filepath.Join(home, "Library", "Fonts"))
			}
		default: // linux and the rest
			add("/usr/share/fonts")
			add("/usr/local/share/fonts")
			if home, _ := os.UserHomeDir(); home != "" {
				add(filepath.Join(home, ".fonts"))
				add(filepath.Join(home, ".local", "share", "fonts"))
			}
		}
	})
	return sysFontRoots
}

// isSystemFontFile reports whether path is a regular file inside one of the
// allowed font roots (after cleaning; symlinks are not followed).
func isSystemFontFile(path string) bool {
	clean := filepath.Clean(path)
	for _, root := range systemFontRoots() {
		r := filepath.Clean(root)
		if clean == r || strings.HasPrefix(clean, r+string(os.PathSeparator)) {
			if st, err := os.Stat(clean); err == nil && !st.IsDir() && st.Size() > 0 && st.Size() < 64<<20 {
				return true
			}
			return false
		}
	}
	return false
}

// systemFonts enumerates every installable font file under the allowed roots.
// Collections (.ttc) are skipped: this app registers one face per buffer and
// a collection holds several.
func systemFonts() ([]SystemFontInfo, error) {
	sysFontsOnce.Do(func() {
		var out []SystemFontInfo
		var walkErr error
		for _, root := range systemFontRoots() {
			_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
				if err != nil {
					if os.IsNotExist(err) {
						return nil
					}
					walkErr = err
					return nil
				}
				if d.IsDir() {
					return nil
				}
				ext := strings.ToLower(filepath.Ext(path))
				if ext != ".ttf" && ext != ".otf" {
					return nil
				}
				family, style := fontNamesFromFile(path)
				if family == "" {
					family = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
				}
				out = append(out, SystemFontInfo{Family: family, Style: style, File: path})
				return nil
			})
		}
		sort.Slice(out, func(i, j int) bool {
			if out[i].Family == out[j].Family {
				return out[i].Style < out[j].Style
			}
			return out[i].Family < out[j].Family
		})
		sysFontsCache = out
		sysFontsErr = walkErr
	})
	return sysFontsCache, sysFontsErr
}

// fontNamesFromFile reads the sfnt "name" table of a TTF/OTF file and
// returns the family and subfamily names (nameID 1/2, with the typographic
// records 16/17 preferred when present). Both are UTF-16BE Windows records.
// Only the first 1 MiB is read: the sfnt directory and the name table live
// in the file head, and a full read (tens of MB for a font collection)
// would make the first enumeration slow.
func fontNamesFromFile(path string) (family, style string) {
	f, err := os.Open(path)
	if err != nil {
		return "", ""
	}
	defer f.Close()
	data := make([]byte, 1<<20)
	n, err := f.Read(data)
	if err != nil && n == 0 {
		return "", ""
	}
	data = data[:n]
	if len(data) < 12 {
		return "", ""
	}
	return fontNamesFromBytes(data)
}

func fontNamesFromBytes(data []byte) (family, style string) {
	defer func() {
		if r := recover(); r != nil {
			family, style = "", ""
		}
	}()
	numTables := int(binary.BigEndian.Uint16(data[4:6]))
	if numTables > 256 {
		return "", ""
	}
	var nameOff int
	for i := 0; i < numTables; i++ {
		rec := 12 + i*16
		if rec+16 > len(data) {
			return "", ""
		}
		if string(data[rec:rec+4]) == "name" {
			nameOff = int(binary.BigEndian.Uint32(data[rec+8 : rec+12]))
			break
		}
	}
	if nameOff == 0 || nameOff+6 > len(data) {
		return "", ""
	}
	count := int(binary.BigEndian.Uint16(data[nameOff+2 : nameOff+4]))
	strOff := nameOff + int(binary.BigEndian.Uint16(data[nameOff+4:nameOff+6]))
	type nameRec struct {
		id       int
		platform int
		len      int
		off      int
	}
	var fam, sub, famTypo, subTypo nameRec
	for i := 0; i < count; i++ {
		rec := nameOff + 6 + i*12
		if rec+12 > len(data) {
			break
		}
		platform := int(binary.BigEndian.Uint16(data[rec : rec+2]))
		id := int(binary.BigEndian.Uint16(data[rec+6 : rec+8]))
		l := int(binary.BigEndian.Uint16(data[rec+8 : rec+10]))
		o := int(binary.BigEndian.Uint16(data[rec+10 : rec+12]))
		if l == 0 || o+l > len(data)-strOff {
			continue
		}
		r := nameRec{id: id, platform: platform, len: l, off: o}
		switch id {
		case 1:
			if fam.len == 0 || (platform == 3 || platform == 0) {
				fam = r
			}
		case 2:
			if sub.len == 0 || (platform == 3 || platform == 0) {
				sub = r
			}
		case 16:
			famTypo = r
		case 17:
			subTypo = r
		}
	}
	utf16 := func(r nameRec) string {
		if r.len == 0 {
			return ""
		}
		b := data[strOff+r.off : strOff+r.off+r.len]
		var sb strings.Builder
		for i := 0; i+1 < len(b); i += 2 {
			sb.WriteRune(rune(binary.BigEndian.Uint16(b[i : i+2])))
		}
		return strings.TrimSpace(sb.String())
	}
	if famTypo.len > 0 {
		family = utf16(famTypo)
	}
	if family == "" {
		family = utf16(fam)
	}
	if subTypo.len > 0 {
		style = utf16(subTypo)
	}
	if style == "" {
		style = utf16(sub)
	}
	return family, style
}

// SystemFonts is the Wails-bound method (kept for future use): returns the
// same list as /api/system-fonts. The HTTP endpoints are the transport the
// sketcher frontend actually uses.
func (a *App) SystemFonts() ([]SystemFontInfo, error) {
	return systemFonts()
}

func handleSystemFonts(w http.ResponseWriter, r *http.Request) {
	fonts, err := systemFonts()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{"fonts": fonts})
}

func handleSystemFontBytes(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("file")
	if path == "" || !isSystemFontFile(path) {
		http.Error(w, "invalid font file", http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".otf":
		w.Header().Set("Content-Type", "application/vnd.ms-opentype")
	default:
		w.Header().Set("Content-Type", "font/ttf")
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", filepath.Base(path)))
	http.ServeFile(w, r, filepath.Clean(path))
}
