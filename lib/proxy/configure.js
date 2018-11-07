const network = require('network');
const proxyUtils = require('./proxy-utils');

exports.configure = (proxyConfig, emitterMod, getProxyIp) => {
  // Proxy Server configs
  network.get_active_interface((error, activeInterface) => {
    if (!error) {
      proxyConfig.Host = {
        SourceMac: proxyUtils.getAddressArray(activeInterface.mac_address),
        SourceIp: proxyUtils.getAddressArray(activeInterface.ip_address),
        GatewayIp: proxyUtils.getAddressArray(activeInterface.gateway_ip)
      };
      proxyConfig.BB = {
        SourceIp: [192, 168, 6, 2],
        GatewayIp: [192, 168, 6, 1],
      };
      proxyConfig.ActiveInterface = activeInterface;
      proxyUtils.getAvailableIp(activeInterface.ip_address).then((proxyIp) => {
        proxyConfig.ProxyIp = proxyUtils.getAddressArray(proxyIp);
        proxyConfig.proxyAdd = proxyIp;
        getProxyIp(proxyIp);
      });
    }
    else emitterMod.emit('error', `Can't get Active Network Interface: ${error}`);
  });
};