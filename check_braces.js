const fs = require('fs');
const content = fs.readFileSync('index.js', 'utf8');
let openBraces = 0;
let inString = false;
let stringChar = '';
let escaped = false;

for (let i = 0; i < content.length; i++) {
  const char = content[i];

  if (inString) {
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === stringChar) {
      inString = false;
    }
  } else {
    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
    } else if (char === '{') {
      openBraces++;
    } else if (char === '}') {
      openBraces--;
      if (openBraces < 0) {
        console.log('Extra closing brace at position', i);
        break;
      }
    }
  }
}
console.log('Final open braces:', openBraces);