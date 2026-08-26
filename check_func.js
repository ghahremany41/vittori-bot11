const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Find the autoDeliverOrder function
const funcStart = content.indexOf('async function autoDeliverOrder');
console.log('Function start:', funcStart);

// Find all braces in this function
let braceCount = 0;
let inString = false;
let stringChar = '';
let escaped = false;
let foundEnd = false;

for (let i = funcStart; i < content.length; i++) {
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
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        console.log('Function ends at:', i);
        console.log('Content after:', content.substring(i, i + 50));
        foundEnd = true;
        break;
      }
    }
  }
}
if (!foundEnd) console.log('Function not closed, final brace count:', braceCount);