// config.js
require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  
  ADMIN_IDS: process.env.ADMIN_IDS 
    ? process.env.ADMIN_IDS.split(',').map(id => Number(id.trim()))
    : [],
  
  DEFAULT_TRAINING_TIME: process.env.DEFAULT_TRAINING_TIME || '20:00',
  DEFAULT_TRAINING_LOCATION: process.env.DEFAULT_TRAINING_LOCATION || 'мкр. Заря',
  DEFAULT_TRAINING_TYPE: process.env.DEFAULT_TRAINING_TYPE || 'ВИИТ тренировка',
  
  LOG_DIR: process.env.LOG_DIR || 'logs'
};
