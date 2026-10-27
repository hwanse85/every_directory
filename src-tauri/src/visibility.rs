pub fn temporary(name: &str) -> bool {
    let name = name.to_lowercase();
    name.starts_with("~$")
        || name.starts_with(".~lock.")
        || name.starts_with(".#")
        || name.ends_with(".tmp")
        || name.ends_with(".temp")
        || name.ends_with(".swp")
        || name.ends_with(".swo")
}
pub fn recycle(path: &str) -> bool {
    path.split(['/', '\\']).any(|p| {
        [
            "$recycle.bin",
            "recycler",
            ".trash",
            ".trashes",
            ".every-directory-trash",
        ]
        .contains(&p.to_lowercase().as_str())
    })
}
pub fn hidden_name(path: &str) -> bool {
    path.split(['/', '\\'])
        .any(|p| p.starts_with('.') && p != "." && p != "..")
}
