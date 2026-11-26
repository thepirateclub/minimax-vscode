// The secrets that slip into a file the deny list does not name: a key in a
// config, a token in a script. Only the forms that are almost never code
// are masked, a false mask would break the edits of the model.
const SECRET_FORMS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{36,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{40,}/g,
  /(?<![A-Za-z0-9_-])xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9][A-Za-z0-9_-]{30,}/g,
  /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g
];

export const SECRET_MASK = '[secret masked]';

export function maskSecrets(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const form of SECRET_FORMS) {
    out = out.replace(form, () => {
      masked++;
      return SECRET_MASK;
    });
  }
  return { text: out, masked };
}
