// Name matcher for a file in the file list, which shows names without their
// extension: `findByRole("button", { name: fileItem("g.csv") })`.
export const fileItem = (fileName: string) => (_: string, el: Element) =>
  el.classList.contains("file-item") && el.querySelector("span")?.firstChild?.textContent === fileName.replace(/\.\w+$/, "");
