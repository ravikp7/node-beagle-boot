const ping = require('ping');

/**
 * @summary Get address array from string
 * @public
 * @param {String} addString - Ip Address or MAC Address
 * @returns {Array} addArray - Address array Eg. [192, 168, 0, 1]
 * 
 * @example
 * const addressArray = getAddressArray('192.168.0.1'); 
 */
const getAddressArray = (addString) => {
  const addArray = [];
  let isIp = false;
  let addressPart = '';
  for (let i = 0; i < addString.length; i++) {
    if (addString.charAt(i) === '.') {
      isIp = true;
      addArray.push(parseInt(addressPart));
      addressPart = '';
    }
    else if (addString.charAt(i) === ':') {
      addArray.push(parseInt(addressPart, 16));
      addressPart = '';
    }
    else addressPart += addString.charAt(i);
    if (i === addString.length - 1) {
      addArray.push(parseInt(addressPart, (isIp) ? 0 : 16));
    }
  }
  return addArray;
};

// Compare IP Addresses
/**
 * @summary Compare two IP Addresses
 * @public
 * 
 * @param {Array} ip1 - IP Address array
 * @param {Array} ip2 - IP Address array
 * 
 * @returns {Boolean} true or false
 * 
 * @example
 * const isEqual = comapareIp([192, 168, 0, 1], [192, 168, 0, 2]);
 */
const compareIp = (ip1, ip2) => {
  let i = 0;
  while (i < 4) {
    if (ip1[i] === ip2[i]) i++;
    else break;
  }
  if (i === 4) return true;
  else return false;
};

/**
 * @summary Find available IP address from Host's subnet
 * @public
 * @description Firstly, jumps to 10 address ahead of host and pings to check
 * if it's available. If yes, allots it otherwise keeps checking next one for
 * availability
 * 
 * @param {String} hostIp - Host IP Adress String
 * @returns {Promise} Resolves to alloted IP Address String
 * 
 * @example
 * getAvailableIp('192.168.0.105').then((proxyIP) => {
 *  console.log(proxyIP);
 * });
 */
const getAvailableIp = async (hostIp) => {
  const pingConfig = {
    timeout: 1
  };
  const incrementIp = (ip, inc) => {
    let newIp = '';
    let lastPart = '';
    let dotCount = 0;
    for (let i = 0; i < ip.length; i++) {
      if (dotCount < 3) newIp += ip.charAt(i);
      else lastPart += ip.charAt(i);
      if (ip.charAt(i) === '.') dotCount++;
    }
    lastPart = parseInt(lastPart) + inc;
    if (lastPart > 254) lastPart = 2;
    return newIp + lastPart;
  };
  let host = incrementIp(hostIp, 10);
  let isAvailable = false;
  while (!isAvailable) {
    let result = await ping.promise.probe(host, pingConfig);
    isAvailable = !result.alive;
    if (isAvailable) break;
    host = incrementIp(host, 1);
  }
  return host;
};

/**
 * @summary Sends packet to Host network
 * @public
 * 
 * @param {Instance of require('cap').Cap} capture 
 * @param {Buffer} data
 */
const sendToNetwork = (capture, data) => {
  try {

    // send will not work if pcap_sendpacket is not supported by underlying `device`
    capture.send(data, data.length);
  } catch (e) {
    console.log(`Error sending packet: ${e}`);
  }
};

module.exports = {
  getAddressArray: getAddressArray,
  compareIp: compareIp,
  getAvailableIp: getAvailableIp,
  sendToNetwork: sendToNetwork
};