#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 데스크톱 앱과 Rust 파일 엔진을 시작한다.
fn main() {
    every_directory_lib::run();
}
