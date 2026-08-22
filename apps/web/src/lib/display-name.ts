/**
 * A name to show for somebody who may not have given one.
 *
 * Google hands back a real name, so most accounts have one. A magic-link user
 * has only ever typed an email address, and `user.name` is whatever Better Auth
 * could infer — often empty. A blank space where a name goes reads as a broken
 * row; the local part of their address is at least theirs.
 */
export function displayName(name: string | null | undefined, email: string): string {
  const given = name?.trim();
  if (given) return given;

  const local = email.split("@")[0] ?? "";

  return (
    local
      // `musthu.gm` and `ana_marie` are both two words wearing a separator.
      // Digits go with them: `sam+prequel2` is Sam, not "Sam Prequel2".
      .split(/[._+-]+/)
      .map((part) => part.replace(/\d+$/, ""))
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || email
  );
}
