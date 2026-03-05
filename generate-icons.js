const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const ICON_SIZE = 81;

const COLORS = {
  selected: '#2E8B57',
  normal: '#999999'
};

// 绘制首页图标（房子）
function drawHomeIcon(ctx, color) {
  ctx.fillStyle = color;
  // 屋顶
  ctx.beginPath();
  ctx.moveTo(40.5, 10);
  ctx.lineTo(10, 38);
  ctx.lineTo(71, 38);
  ctx.closePath();
  ctx.fill();
  // 墙体
  ctx.fillRect(18, 38, 45, 43);
  // 门
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(35, 52, 12, 29);
}

// 绘制小组图标（人群）
function drawGroupIcon(ctx, color) {
  ctx.fillStyle = color;
  // 中间人
  ctx.beginPath();
  ctx.arc(40.5, 28, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(28.5, 40, 24, 30);
  // 左边人
  ctx.beginPath();
  ctx.arc(18, 35, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(9, 44, 18, 25);
  // 右边人
  ctx.beginPath();
  ctx.arc(63, 35, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(54, 44, 18, 25);
}

// 绘制朋友圈图标（相册/照片）
function drawMomentsIcon(ctx, color) {
  ctx.fillStyle = color;
  // 相框
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 15, 61, 51);
  // 照片内部
  ctx.fillRect(15, 20, 51, 41);
  // 照片中的风景（山和太阳）
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(18, 35, 45, 23);
  // 太阳
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(55, 28, 6, 0, Math.PI * 2);
  ctx.fill();
  // 山
  ctx.beginPath();
  ctx.moveTo(18, 55);
  ctx.lineTo(30, 38);
  ctx.lineTo(42, 55);
  ctx.lineTo(50, 45);
  ctx.lineTo(60, 55);
  ctx.lineTo(63, 55);
  ctx.closePath();
  ctx.fill();
}

// 绘制我的图标（人物）
function drawProfileIcon(ctx, color) {
  ctx.fillStyle = color;
  // 头部
  ctx.beginPath();
  ctx.arc(40.5, 25, 14, 0, Math.PI * 2);
  ctx.fill();
  // 身体
  ctx.beginPath();
  ctx.arc(40.5, 60, 22, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(18.5, 60, 44, 21);
}

function createIcon(drawFn, color) {
  const canvas = createCanvas(ICON_SIZE, ICON_SIZE);
  const ctx = canvas.getContext('2d');
  
  // 启用高分辨率渲染
  ctx.scale(1, 1);
  
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
    console.log(`Created ${state}/${icon.name}.png`);
  });
});

console.log('Done!');
