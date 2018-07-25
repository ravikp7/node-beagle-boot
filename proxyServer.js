const BB = require('./main');
const emitter = BB.proxyServer();

console.log(`Server started`);
console.log(`Connect BeagleBone to get started`);

emitter.on('progress', (status) => {
  console.log(status);
});

emitter.on('error', (error) => {
  console.log(`Error: ${error}`);
});
