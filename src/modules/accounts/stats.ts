// Counts shown on the accounts pages.
import { accountsOf, hasProxy, oddLines, type AccountsDoc } from "../../lib/formats/accounts";

export interface AccountStats {
  accounts: number;
  withProxy: number;
  /** Lines that aren't accounts, not counting blank ones. */
  odd: number;
  /** Accounts per email domain, most first (ties by name). */
  domains: { domain: string; count: number }[];
}

export function accountStats(doc: AccountsDoc): AccountStats {
  const list = accountsOf(doc);
  const byDomain = new Map<string, number>();
  for (const a of list) {
    const domain = a.email.slice(a.email.lastIndexOf("@") + 1).toLowerCase();
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }
  return {
    accounts: list.length,
    withProxy: list.filter(hasProxy).length,
    odd: oddLines(doc).length,
    domains: [...byDomain]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)),
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
