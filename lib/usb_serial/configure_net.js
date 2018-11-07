const serialInt = require('./set_endpoints');
const EOL_LENGTH = require('os').EOL.length;

exports.configureNet = (serverConfig, proxyConfig) => {
  const serial = serialInt(serverConfig);
  console.log(`Waiting for Serial Data! Initializing network in a minute..`);
  const config = {
    user: ``,
    password: ``,
    prompt: ``,
    network: false
  };
  serial.on('data', (data) => {
    const result = data.toString(); 
    if (result.slice(-7, -1) === `login:` || result === `Password: `) {
      config.prompt = result;
      process.stdout.write(result, (error) => {
        if (error) console.log(error);
      });
    }
    if (result === `${config.user}@beaglebone:~$ ` && config.network === false) {
      serial.emit('send', Buffer.from(`sudo /sbin/route add default gw 192.168.6.1; sudo ifconfig usb1 mtu 480; sudo ex +'$put =\\"nameserver 8.8.8.8\\"' -cwq /etc/resolv.conf\n`));
      config.network = true;
      console.log(`Networking enabled. Now you can ssh ${config.user}@${proxyConfig.proxyAdd}`);
    }
    if (result === `[sudo] password for ${config.user}: `) {
      serial.emit('send', Buffer.from(`${config.password}\n`));
    }
  });
  serial.on('error', (error) => {
    console.log(error);
  });
  process.stdin.on('data', (data) => {
    if (config.prompt.slice(-7, -1) === `login:`) {
      config.user = data.toString().slice(0, -1*EOL_LENGTH);
      config.prompt = ``;
      serial.emit('send', data);
    }
    if (config.prompt === `Password: `) {
      config.password = data.toString().slice(0, -1*EOL_LENGTH);
      config.prompt = ``;
      serial.emit('send', data);
    }
  });
};