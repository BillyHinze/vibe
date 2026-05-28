// middleware/upload.js
// Falls back to local disk storage if Cloudinary is not configured.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const hasCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

let uploadAvatar, uploadAttachment, uploadServerIcon, cloudinary;

if (hasCloudinary) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  const { CloudinaryStorage } = require('multer-storage-cloudinary');

  const avatarStorage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'vibe/avatars',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
      transformation: [{ width: 256, height: 256, crop: 'fill' }],
    },
  });

  const attachmentStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder: 'vibe/attachments',
      resource_type: 'auto',
    }),
  });

  const serverIconStorage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'vibe/server-icons',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 128, height: 128, crop: 'fill' }],
    },
  });

  uploadAvatar     = multer({ storage: avatarStorage,     limits: { fileSize: 5  * 1024 * 1024 } });
  uploadAttachment = multer({ storage: attachmentStorage, limits: { fileSize: 25 * 1024 * 1024 } });
  uploadServerIcon = multer({ storage: serverIconStorage, limits: { fileSize: 5  * 1024 * 1024 } });

  console.log('✅ Cloudinary storage enabled');
} else {
  // Local disk fallback — files served from /uploads
  console.warn('⚠️  Cloudinary not configured — using local disk storage at ./public/uploads/');

  const ensureDir = (dir) => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); };

  const makeLocalStorage = (subfolder) => multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '..', 'public', 'uploads', subfolder);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  });

  // Attach a .path property matching what Cloudinary returns so route code is identical
  const wrapLocalUpload = (subfolder, sizeLimitMB = 5) => {
    const storage = makeLocalStorage(subfolder);
    const upload = multer({ storage, limits: { fileSize: sizeLimitMB * 1024 * 1024 } });
    // Middleware wrapper: sets req.file.path to the public URL
    return {
      single: (field) => (req, res, next) => {
        upload.single(field)(req, res, (err) => {
          if (err) return next(err);
          if (req.file) {
            req.file.path = `/uploads/${subfolder}/${req.file.filename}`;
          }
          next();
        });
      },
    };
  };

  uploadAvatar     = wrapLocalUpload('avatars');
  uploadAttachment = wrapLocalUpload('attachments', 25);
  uploadServerIcon = wrapLocalUpload('server-icons');
  cloudinary       = null;
}

module.exports = { uploadAvatar, uploadAttachment, uploadServerIcon, cloudinary };
