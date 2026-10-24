import { homedir, tmpdir } from "node:os";
import path from "node:path";

// Encode each rustc argument separately so paths containing spaces remain intact.
export function privateBuildEnvironment(base = process.env, options = {}) {
  const home = options.home ?? homedir();
  const mappings = [
    [home, "/build/user"],
    [options.temp ?? tmpdir(), "/build/tmp"],
    [base.CARGO_HOME ?? path.join(home, ".cargo"), "/build/cargo"],
    [base.RUSTUP_HOME ?? path.join(home, ".rustup"), "/build/rustup"],
    [options.root ?? process.cwd(), "/build/every-directory"],
  ];
  const flags = base.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? base.CARGO_ENCODED_RUSTFLAGS.split("\x1f").filter(Boolean)
    : (base.RUSTFLAGS ?? "").trim().split(/\s+/).filter(Boolean);
  for (const [source, replacement] of mappings) {
    const variants = new Set([source, source.replaceAll("\\", "/"), source.replaceAll("/", "\\")]);
    if (/^[A-Za-z]:[\\/]/.test(source)) {
      variants.add(`\\\\?\\${source.replaceAll("/", "\\")}`);
      variants.add(`//?/${source.replaceAll("\\", "/")}`);
    }
    for (const variant of variants) flags.push(`--remap-path-prefix=${variant}=${replacement}`);
  }
  const env = { ...base, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") };
  delete env.RUSTFLAGS;
  return env;
}
