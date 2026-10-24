// 화면 설정을 안전하게 복원하고 잘못된 저장값은 기본값으로 대체한다.
export function readPreference<T>(key: string, fallback: T): T {
  try {
    const storage =
      import.meta.env.VITE_ED_VERIFICATION === "1"
        ? sessionStorage
        : localStorage;
    return JSON.parse(storage.getItem(`ed:${key}`) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

// 브라우저 저장 제한이 있어도 현재 세션의 작업은 계속한다.
export function savePreference(key: string, value: unknown): void {
  try {
    const storage =
      import.meta.env.VITE_ED_VERIFICATION === "1"
        ? sessionStorage
        : localStorage;
    storage.setItem(`ed:${key}`, JSON.stringify(value));
  } catch {
    console.warn("화면 설정을 저장할 수 없습니다.");
  }
}
