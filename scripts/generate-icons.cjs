const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Create a simple SVG icon with text
const createSVG = (size, text) => `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#1264A3"/>
  <text x="50%" y="50%" font-family="Arial" font-size="${size / 2}px" fill="white" text-anchor="middle" dominant-baseline="middle">
    ${text}
  </text>
</svg>`;

// Ensure dist directory exists
const distDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// Generate icons
async function generateIcons() {
  const sizes = [16, 48, 128];

  for (const size of sizes) {
    const svg = createSVG(size, 'AS');
    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    fs.writeFileSync(path.join(distDir, `icon${size}.png`), pngBuffer);
    console.log(`Generated icon${size}.png`);
  }
}

generateIcons().catch(console.error);
