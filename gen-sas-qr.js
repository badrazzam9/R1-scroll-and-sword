const QRCode = require('qrcode');
const data = {
  title: 'Scroll & Sword',
  url: 'https://badrazzam9.github.io/R1-scroll-and-sword/',
  description: 'Pixel rogue-narrative RPG with Wheel of Fate',
  iconUrl: 'https://fav.farm/⚔️',
  themeColor: '#6ea8ff'
};
QRCode.toFile('C:/Users/Badr/.openclaw/workspace/scroll-and-sword/scroll-and-sword-qr.png', JSON.stringify(data), { width: 400 }, (err) => {
  if (err) throw err;
  console.log('ok');
});