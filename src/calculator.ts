// 빠른 검색의 간단한 계산: 사칙연산·나머지·거듭제곱·괄호를 직접 해석한다(eval을 쓰지 않는다).
// 숫자만 있거나 연산자가 없는 검색어(파일 이름일 수 있음)는 계산식으로 보지 않는다.

// 계산식으로 볼 수 있는 입력인지 확인한다. 앞의 '='는 계산식이라는 표시로 쓴다.
export function looksLikeMath(input: string): boolean {
  const text = input.trim().replace(/^=/, "").replace(/[×x]/g, "*").replace(/÷/g, "/");
  if (!/^[\d\s.,+\-*/%^()]+$/.test(text)) return false;
  const numbers = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  // 띄어 쓰지 않은 빼기만 있는 입력(2026-03, 010-1234-5678)은 날짜·번호일 수 있어 계산하지 않는다.
  if (!/[+*/%^]/.test(text) && !/\s-\s/.test(text) && !input.trim().startsWith("=")) return false;
  // 연산자 하나와 숫자 둘 이상(또는 = 로 시작)
  return (input.trim().startsWith("=") && numbers.length >= 1) || (numbers.length >= 2 && /\d\s*[+\-*/%^]\s*[\d(]/.test(text));
}

// 계산식을 값으로 바꾼다. 해석할 수 없거나 0으로 나누면 undefined.
export function calculate(input: string): number | undefined {
  if (!looksLikeMath(input)) return;
  const text = input.trim().replace(/^=/, "").replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/(\d),(?=\d{3}\b)/g, "$1");
  let at = 0;
  // 공백을 건너뛰고 다음 글자를 본다.
  const peek = () => {
    while (text[at] === " ") at++;
    return text[at];
  };
  // 숫자 또는 괄호 식
  function primary(): number {
    const c = peek();
    if (c === "(") {
      at++;
      const value = sum();
      if (peek() !== ")") throw new Error("괄호");
      at++;
      return value;
    }
    if (c === "-" || c === "+") {
      at++;
      const value = power();
      return c === "-" ? -value : value;
    }
    const match = /^\d+(?:\.\d+)?/.exec(text.slice(at));
    if (!match) throw new Error("숫자");
    at += match[0].length;
    return Number(match[0]);
  }
  // 거듭제곱(오른쪽부터 묶음)
  function power(): number {
    const base = primary();
    if (peek() === "^") {
      at++;
      return base ** power();
    }
    return base;
  }
  // 곱셈·나눗셈·나머지
  function product(): number {
    let value = power();
    for (let c = peek(); c === "*" || c === "/" || c === "%"; c = peek()) {
      at++;
      const right = power();
      if ((c === "/" || c === "%") && right === 0) throw new Error("0으로 나눔");
      value = c === "*" ? value * right : c === "/" ? value / right : value % right;
    }
    return value;
  }
  // 덧셈·뺄셈
  function sum(): number {
    let value = product();
    for (let c = peek(); c === "+" || c === "-"; c = peek()) {
      at++;
      value = c === "+" ? value + product() : value - product();
    }
    return value;
  }
  try {
    const value = sum();
    if (peek() !== undefined || !Number.isFinite(value)) return;
    return value;
  } catch {
    return;
  }
}

// 결과를 보기 좋게(천 단위 구분, 소수 12자리까지) 쓴다.
export function formatResult(value: number): string {
  const rounded = Math.round(value * 1e12) / 1e12;
  return rounded.toLocaleString("ko-KR", { maximumFractionDigits: 12 });
}
