use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub show_hidden: bool,
    pub show_temporary: bool,
    pub show_recycle_bin: bool,
    pub highlight_matches: bool,
    pub font_scale: u16,
    pub active_pane_accent: String,
    pub default_explorer_view: String,
    pub search_delay: u16,
    pub search_page_size: usize,
    pub quick_full_path: bool,
    pub clipboard_enabled: bool,
    pub clipboard_days: u16,
    pub clipboard_keyword: String,
    pub clipboard_text: bool,
    pub clipboard_images: bool,
    pub clipboard_files: bool,
    pub clipboard_max_mb: u16,
    pub clipboard_excluded_apps: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            show_hidden: false,
            show_temporary: false,
            show_recycle_bin: false,
            highlight_matches: true,
            font_scale: 100,
            active_pane_accent: "blue".into(),
            default_explorer_view: "list".into(),
            search_delay: 80,
            search_page_size: 1000,
            quick_full_path: true,
            clipboard_enabled: true,
            clipboard_days: 10,
            clipboard_keyword: "clip".into(),
            clipboard_text: true,
            clipboard_images: true,
            clipboard_files: true,
            clipboard_max_mb: 16,
            clipboard_excluded_apps: "1password.exe;bitwarden.exe;keepass.exe;keepassxc.exe".into(),
        }
    }
}
impl Preferences {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=60).contains(&self.clipboard_days)
            || !(1..=64).contains(&self.clipboard_max_mb)
            || !(90..=140).contains(&self.font_scale)
            || !(40..=500).contains(&self.search_delay)
            || !(100..=1000).contains(&self.search_page_size)
        {
            return Err("설정 범위가 올바르지 않습니다.".into());
        }
        if self.clipboard_keyword.is_empty()
            || self.clipboard_keyword.chars().count() > 32
            || !self
                .clipboard_keyword
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            return Err("키워드는 공백 없이 문자·숫자·_·-로 1~32자 입력해 주세요.".into());
        }
        if self.clipboard_excluded_apps.len() > 4096
            || self.clipboard_excluded_apps.contains(['/', '\\'])
        {
            return Err("제외 앱은 실행 파일 이름을 세미콜론으로 구분해 주세요.".into());
        }
        if !["blue", "violet", "orange", "green"].contains(&self.active_pane_accent.as_str())
            || ![
                "list",
                "grid",
                "compact",
                "content",
                "icons-small",
                "icons-medium",
                "icons-large",
                "icons-extra",
            ]
            .contains(&self.default_explorer_view.as_str())
        {
            return Err("지원하지 않는 화면 설정입니다.".into());
        }
        Ok(())
    }
}
pub struct PreferenceStore {
    pub value: Mutex<Preferences>,
    path: PathBuf,
    pub warning: Mutex<Option<String>>,
}
impl PreferenceStore {
    pub fn load(data: &std::path::Path) -> Result<Self, String> {
        let path = data.join("preferences.json");
        let mut warning = None;
        let value = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Preferences>(&bytes)
                .ok()
                .filter(|p| p.validate().is_ok())
            {
                Some(p) => p,
                None => {
                    warning=Some("사용자 설정 파일이 손상되어 기본값을 적용했습니다. 기존 파일은 저장 전까지 유지됩니다.".into());
                    Preferences::default()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Preferences::default(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self {
            value: Mutex::new(value),
            path,
            warning: Mutex::new(warning),
        })
    }
    pub fn save(&self, next: Preferences) -> Result<Preferences, String> {
        next.validate()?;
        let mut p = self.value.lock().unwrap();
        crate::store::write_json(&self.path, &next)?;
        *p = next.clone();
        *self.warning.lock().unwrap() = None;
        Ok(next)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_bounds_and_restart() {
        let t = tempfile::tempdir().unwrap();
        let store = PreferenceStore::load(t.path()).unwrap();
        let mut p = Preferences::default();
        assert_eq!(p.clipboard_days, 10);
        assert!(!p.show_hidden);
        p.clipboard_days = 60;
        p.clipboard_keyword = "clips".into();
        store.save(p).unwrap();
        assert_eq!(
            PreferenceStore::load(t.path())
                .unwrap()
                .value
                .lock()
                .unwrap()
                .clipboard_days,
            60
        );
        let mut bad = Preferences::default();
        bad.clipboard_days = 0;
        assert!(store.save(bad).is_err());
        assert_eq!(store.value.lock().unwrap().clipboard_keyword, "clips");
    }
}

pub fn portable_directory() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let parent = executable.parent()?;
    parent
        .join("portable.flag")
        .is_file()
        .then(|| parent.join("portable-data"))
}
