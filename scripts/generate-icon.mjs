import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(projectRoot, "build", "icon.png");
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="192" fill="#0b111a"/>
  <rect x="20" y="20" width="984" height="984" rx="174" fill="none" stroke="#273243" stroke-width="16"/>
  <circle cx="512" cy="512" r="302" fill="none" stroke="#70a5ff" stroke-opacity="0.42" stroke-width="12"/>
  <ellipse cx="512" cy="512" rx="144" ry="338" fill="none" stroke="#8be6c1" stroke-opacity="0.38" stroke-width="12" transform="rotate(52 512 512)"/>
  <ellipse cx="512" cy="512" rx="144" ry="338" fill="none" stroke="#8be6c1" stroke-opacity="0.30" stroke-width="12" transform="rotate(-52 512 512)"/>
  <circle cx="352" cy="250" r="30" fill="#70a5ff"/>
  <circle cx="788" cy="642" r="30" fill="#8be6c1"/>
  <circle cx="250" cy="692" r="25" fill="#f6ce72"/>
  <rect x="286" y="365" width="452" height="294" rx="70" fill="#111721" stroke="#8be6c1" stroke-width="10"/>
  <text x="512" y="566" fill="#ecf2f8" font-family="Segoe UI, Arial, sans-serif" font-size="174" font-weight="700" text-anchor="middle" letter-spacing="0">CG</text>
</svg>`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 1024, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const html = `<!doctype html><style>html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:#0b111a}</style>${svg}`;
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const image = (await window.webContents.capturePage()).resize({ width: 1024, height: 1024, quality: "best" });
  if (image.isEmpty()) throw new Error("Icon rendering produced an empty image");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, image.toPNG());
  window.destroy();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
