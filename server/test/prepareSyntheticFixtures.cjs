// Only creates explicitly fictional fixtures when neither target exists.
const fs = require('node:fs');
const path = require('node:path');
const entries = [
  [path.join(__dirname, 'fixtures', 'account-isolation', 'users.example.json'), path.join(__dirname, 'fixtures', 'account-isolation', 'users.json')],
  [path.join(__dirname, 'fixtures', 'users.example.json'), path.join(__dirname, '..', 'data', 'users.json')],
];
if (entries.some(([, target]) => fs.existsSync(target))) {
  console.error('測試帳號檔已存在；為保護既有資料，不予覆寫任何檔案。');
  process.exitCode = 1;
} else {
  for (const [source, target] of entries) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
  console.log('已建立虛構測試帳號；此檔案不應加入 Git。');
}
