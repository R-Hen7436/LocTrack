const fs = require('fs');
const path = require('path');

function removeComments(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    const jsdocComments = [];
    content = content.replace(/\/\*\*[\s\S]*?\*\//g, (match) => {
      jsdocComments.push(match);
      return `__JSDOC_${jsdocComments.length - 1}__`;
    });

    const strings = [];
    content = content.replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, (match) => {
      strings.push(match);
      return `__STRING_${strings.length - 1}__`;
    });
    
    content = content
      .replace(/\/\/.*/g, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/^\s*[\r\n]/gm, '') // Remove empty lines
      .replace(/[ \t]+$/gm, '') // Remove trailing spaces
      .replace(/\n{3,}/g, '\n\n'); // Reduce multiple blank lines to max 2
    
    content = content.replace(/__STRING_(\d+)__/g, (_, index) => strings[index]);
    content = content.replace(/__JSDOC_(\d+)__/g, (_, index) => jsdocComments[index]);
    
    fs.writeFileSync(filePath, content);
    console.log(`Processed: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return false;
  }
}

function processDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'scripts') {
        processDirectory(fullPath);
      }
    } else if (stat.isFile() && /\.(js|jsx|ts|tsx)$/.test(file) && !fullPath.includes('removeComments.js')) {
      removeComments(fullPath);
    }
  }
}

const workspaceRoot = process.cwd();
console.log('Starting comment removal process...');
processDirectory(workspaceRoot);
console.log('Comment removal process completed.');