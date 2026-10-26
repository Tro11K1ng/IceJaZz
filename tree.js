// filepath: tree.js
import fs from 'fs';
import path from 'path';

const IGNORE_LIST = ['.git', 'node_modules', 'dist', 'build', '.env', '.DS_Store'];

function generateTree(dir, prefix = '') {
  let result = '';
  let files;
  
  try {
    files = fs.readdirSync(dir).filter(file => !IGNORE_LIST.includes(file));
  } catch (err) {
    return result;
  }

  files.forEach((file, index) => {
    const isLast = index === files.length - 1;
    const pointer = isLast ? 'L-- ' : '|-- ';
    result += prefix + pointer + file + '\n';

    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      result += generateTree(fullPath, prefix + (isLast ? '    ' : '|   '));
    }
  });

  return result;
}

const output = "[ TRL_PROJECT_TREE :: TrollKing ]\n.\n" + generateTree(process.cwd());
fs.writeFileSync('TRL_tree.txt', output);
console.log('Project tree saved to TRL_tree.txt');