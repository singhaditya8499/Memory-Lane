const path = require('path');
const multer = require('multer');

const storage = multer.diskStorage({
  destination: function destination(_req, _file, cb) {
    cb(null, path.join(__dirname, '..', '..', 'public', 'uploads'));
  },
  filename: function filename(_req, file, cb) {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${suffix}${ext}`);
  }
});

function fileFilter(_req, file, cb) {
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    cb(null, true);
    return;
  }

  cb(new Error('Only image files are allowed.'));
}

const upload = multer({ storage, fileFilter });

module.exports = upload;
