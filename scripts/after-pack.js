/*
 * electron-builder afterPack 钩子：
 * 在非 Windows 系统上交叉打包时（无 wine/rcedit），用纯 JS 的 resedit
 * 为 MoyuFox.exe 写入应用图标与版本信息。
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { appOutDir, packager } = context;
  const info = packager.appInfo;
  const exeName = `${packager.platformSpecificBuildOptions.executableName || info.productFilename}.exe`;
  const exePath = path.join(appOutDir, exeName);
  const icoPath = path.join(packager.info.projectDir, 'build', 'icon.ico');
  if (!fs.existsSync(exePath)) throw new Error(`[after-pack] 找不到 ${exePath}`);

  const ResEdit = await import('resedit');
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const targets = groups.length ? groups.map((g) => ({ id: g.id, lang: g.lang })) : [{ id: 1, lang: 1033 }];
  for (const t of targets) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, t.id, t.lang, iconFile.icons.map((i) => i.data));
  }

  const version = info.version;
  const [maj, min, pat] = version.split('.').map((n) => parseInt(n, 10) || 0);
  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const langs = vi.getAllLanguagesForStringValues();
  const lang = langs[0] || { lang: 1033, codepage: 1200 };
  vi.setFileVersion(maj, min, pat, 0, lang.lang);
  vi.setProductVersion(maj, min, pat, 0, lang.lang);
  vi.setStringValues(lang, {
    FileDescription: info.productName,
    ProductName: info.productName,
    CompanyName: 'MoyuFox',
    LegalCopyright: info.copyright,
    OriginalFilename: exeName,
    InternalName: 'MoyuFox',
    FileVersion: version,
    ProductVersion: version,
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log(`  • [after-pack] 已写入图标与版本信息 → ${exeName}`);
};
