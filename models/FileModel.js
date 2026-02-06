const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, required: true }, 
  parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  filename: { type: String, required: true },
  storageKey: { type: String, required: true }, 
  extension: String,
  size: { type: Number, required: true },
  mimetype: String,
  fileData: { type: Buffer, select: false }, 
  isEncrypted: { type: Boolean, default: false },
}, { timestamps: true });

// Ensure unique filenames per folder
fileSchema.index({ owner: 1, parentFolder: 1, filename: 1 }, { unique: true });

module.exports = mongoose.model('File', fileSchema);