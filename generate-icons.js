const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ICON_SIZE = 200;

const COLORS = {
  selected: '#2E8B57',
  normal: '#999999'
};

// 绘制首页图标（简约房子）
function drawHomeIcon(ctx, color) {
  ctx.fillStyle = color;
  
  // 屋顶
  ctx.beginPath();
  ctx.moveTo(100, 25);
  ctx.lineTo(40, 85);
  ctx.lineTo(160, 85);
  ctx.closePath();
  ctx.fill();
  
  // 墙体
  ctx.fillRect(50, 85, 100, 90);
  
  // 门
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(82, 125, 36, 50);
  
  // 门把手
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(110, 155, 4, 0, Math.PI * 2);
  ctx.fill();
}

// 绘制小组图标（三人团队）
function drawGroupIcon(ctx, color) {
  ctx.fillStyle = color;
  
  // 中间人（头部）
  ctx.beginPath();
  ctx.arc(100, 50, 20, 0, Math.PI * 2);
  ctx.fill();
  
  // 中间人（身体）
  ctx.beginPath();
  ctx.arc(100, 95, 28, 0, Math.PI, false);
  ctx.fill();
  
  // 左边人（头部）
  ctx.beginPath();
  ctx.arc(40, 65, 14, 0, Math.PI * 2);
  ctx.fill();
  
  // 左边人（身体）
  ctx.beginPath();
  ctx.arc(40, 100, 18, 0, Math.PI, false);
  ctx.fill();
  
  // 右边人（头部）
  ctx.beginPath();
  ctx.arc(160, 65, 14, 0, Math.PI * 2);
  ctx.fill();
  
  // 右边人（身体）
  ctx.beginPath();
  ctx.arc(160, 100, 18, 0, Math.PI, false);
  ctx.fill();
}

// 绘制成长墙图标（相框）
function drawMomentsIcon(ctx, color) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  
  // 外框
  ctx.strokeRect(35, 35, 130, 130);
  
  // 内部分隔线
  ctx.beginPath();
  ctx.moveTo(35, 90);
  ctx.lineTo(165, 90);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(100, 35);
  ctx.lineTo(100, 90);
  ctx.stroke();
  
  // 星星
  ctx.beginPath();
  ctx.arc(145, 145, 8, 0, Math.PI * 2);
  ctx.fill();
}

// 绘制我的图标（人物）
function drawProfileIcon(ctx, color) {
  ctx.fillStyle = color;
  
  // 头部
  ctx.beginPath();
  ctx.arc(100, 50, 28, 0, Math.PI * 2);
  ctx.fill();
  
  // 身体
  ctx.beginPath();
  ctx.arc(100, 125, 45, Math.PI * 0.2, Math.PI * 0.8, false);
  ctx.closePath();
  ctx.fill();
}

function createIcon(drawFn, color) {
  const canvas = createCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext('2d');

  drawFn(ctx, color);

  return canvas.toBuffer('image/png');
}

const icons = [
  { name: 'index', draw: drawHomeIcon },
  { name: 'group', draw: drawGroupIcon },
  { name: 'moments', draw: drawMomentsIcon },
  { name: 'profile', draw: drawProfileIcon }
];

const baseDir = path.join(__dirname, 'miniprogram', 'assets', 'icons');

['selected', 'normal'].forEach(state => {
  const stateDir = path.join(baseDir, state);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  icons.forEach(icon => {
    const color = state === 'selected' ? COLORS.selected : COLORS.normal;
    const buffer = createIcon(icon.draw, color);
    fs.writeFileSync(path.join(stateDir, `${icon.name}.png`), buffer);
    console.log(`Created ${state}/${icon.name}.png (${buffer.length} bytes)`);
  });
});

console.log('Done!');
