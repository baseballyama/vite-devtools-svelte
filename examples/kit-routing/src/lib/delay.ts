/** Wait `ms` so each load shows up as a visible bar in the Load functions waterfall. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
