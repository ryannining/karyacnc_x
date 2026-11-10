import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

// Files that are NOT project assets. They are created/removed behind the scenes
// by the SMB/Samba server (e.g. ".__smb0001" temp files used during
// rename/delete), by macOS ("._*" resource forks) or by Windows/editors.
// Vite's default publicDir copier copies *everything* and aborts the whole
// build with `EPERM: operation not permitted, copyfile` when one of these
// temporary files vanishes mid-copy on a network share.
const JUNK_FILE = /^(\.__smb.*|\._[^\\/]*|\.DS_Store|Thumbs\.db|desktop\.ini|~\$.*)$/i

// Replacement for Vite's built-in `copyPublicDir` (Vite 3 has no ignore
// option): copy public/ -> dist/ ourselves, skipping junk and surviving files
// that disappear or are locked while the build runs.
function copyPublicAssets() {
    let publicDir = ''
    let outDir = ''
    let logger = console
    const skipped = []

    function copyDir(srcDir, destDir) {
        fs.mkdirSync(destDir, { recursive: true })
        for (const entry of fs.readdirSync(srcDir)) {
            const src = path.join(srcDir, entry)
            const rel = path.relative(publicDir, src)
            if (JUNK_FILE.test(entry)) {
                skipped.push(`${rel} (junk)`)
                continue
            }
            let stat
            try {
                stat = fs.statSync(src)
            } catch (err) {
                // SMB server already removed it between readdir and stat
                skipped.push(`${rel} (${err.code})`)
                continue
            }
            if (stat.isDirectory()) {
                copyDir(src, path.join(destDir, entry))
            } else {
                try {
                    fs.copyFileSync(src, path.join(destDir, entry))
                } catch (err) {
                    // Locked/vanished transient file: skip instead of killing the build
                    skipped.push(`${rel} (${err.code})`)
                }
            }
        }
    }

    // `//go:embed all:frontend/dist` also embeds dot-files, so make sure no SMB
    // leftover is ever shipped inside the binary.
    function cleanJunk(dir) {
        for (const entry of fs.readdirSync(dir)) {
            const target = path.join(dir, entry)
            let stat
            try {
                stat = fs.statSync(target)
            } catch (err) {
                continue
            }
            if (stat.isDirectory()) {
                cleanJunk(target)
            } else if (JUNK_FILE.test(entry)) {
                try {
                    fs.unlinkSync(target)
                    skipped.push(`${path.relative(outDir, target)} (junk, removed)`)
                } catch (err) {
                    skipped.push(`${path.relative(outDir, target)} (${err.code})`)
                }
            }
        }
    }

    return {
        name: 'karyacnc:copy-public-assets',
        apply: 'build',
        configResolved(config) {
            publicDir = config.publicDir
            outDir = path.resolve(config.root, config.build.outDir)
            logger = config.logger
        },
        closeBundle() {
            if (!outDir) return
            skipped.length = 0
            if (publicDir && fs.existsSync(publicDir)) {
                copyDir(publicDir, outDir)
            }
            if (fs.existsSync(outDir)) {
                cleanJunk(outDir)
            }
            if (skipped.length > 0) {
                const shown = skipped.slice(0, 5).join(', ')
                const more = skipped.length > 5 ? ` … (+${skipped.length - 5} more)` : ''
                logger.warn(`[copy-public-assets] ignored ${skipped.length} non-asset file(s): ${shown}${more}`)
            }
        }
    }
}

export default defineConfig({
    plugins: [copyPublicAssets()],
    build: {
        // Let our plugin copy public/ so SMB junk files can never abort the build
        copyPublicDir: false
    },
    server: {
        watch: {
            // Use polling to ensure changes are detected on Windows/network drives
            usePolling: true,
            interval: 100,
            // Explicitly watch the public directory if needed, though usually included
            include: ['public/**']
        }
    }
})
