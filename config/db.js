const mongoose = require('mongoose');
require('colors');
require('dotenv').config(); 

const connectDB = async () => {
    try {
        const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/filemanager';

        mongoose.set('strictQuery', true);

        const conn = await mongoose.connect(MONGO_URI);

        console.log(`\nMongoDB Connected: ${conn.connection.host}`.green.bold);
        
    } catch (error) {
        console.error(`\nMongoDB Connection Error: ${error.message}`.red.bold);
        
        if (error.code === 'ECONNREFUSED') {
             console.log(`Tip: Check karein ki MongoDB Service aapke PC par chalu hai ya nahi.`.yellow);
             console.log(`(Windows: Services > MongoDB Server > Start)`.yellow);
        } else {
             console.log(`Tip: Apna Internet connection ya .env file check karein.`.yellow);
        }

        process.exit(1); 
    }
};

module.exports = connectDB;