//go:build bindings

package main

// isBindingsGeneration mendeteksi build tag "bindings" yang dipakai Wails saat
// meng-compile & menjalankan binary sementara (wailsbindings) untuk generate
// binding. Pada mode ini jangan mulai mode browser — cukup jatuh ke wails.Run
// yang akan mencetak binding lalu keluar.
func isBindingsGeneration() bool { return true }
