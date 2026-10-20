export function normalizedUrl(input) {
  try {
    const u = new URL(input);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
      return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^(gclid|fbclid)$/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch {
    return null;
  }
}
