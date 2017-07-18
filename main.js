const ROMVID = 0x0451;
const ROMPID = 0x6141;
const BOOTPS = 67;
const BOOTPC = 68;
const IPUDP = 17;
const SPLVID = 0x0525;
const SPLPID = 0xA4A2;
const ETHIPP = 0x0800;
const ETHARPP = 0x0806;
const MAXBUF = 450;
const server_hwaddr = [0x9a, 0x1f, 0x85, 0x1c, 0x3d, 0x0e];
const server_ip = [0xc0, 0xa8, 0x01, 0x09];     // 192.168.1.9
const BB_ip = [0xc0, 0xa8, 0x01, 0x03];         // 192.168.1.3
const servername = [66, 69, 65, 71, 76, 69, 66, 79, 79, 84];       // ASCII ['B','E','A','G','L','E','B','O','O','T']
const file_spl = [83, 80, 76, 0, 0];                             // ASCII ['S','P','L']
const file_uboot = [85, 66, 79, 79, 84];                           // ASCII ['U','B','O','O','T']

// Size of all packets
var rndisSize = 44;
var etherSize = 14;
var arp_Size = 28;
var ipSize = 20;
var udpSize = 8;
var bootpSize = 300;
var tftpSize = 4;
var fullSize = 386;


// Include modules
var usb = require('usb');
var protocols = require('./src/protocols');
var EventEmitter = require('events').EventEmitter;
var emitter = new EventEmitter();
var fs = require('fs');
var os = require('os');
var platform = os.platform();
var rndis_win = require('./src/rndis_win');
var inEndpoint, outEndpoint, data, ether, rndis, eth2, ip, udp, bootreply;

// Set usb debug log
//usb.setDebugLevel(4);   


// Connect to BeagleBone
if(!usb.findByIds(ROMVID, ROMPID))
console.log("Connect your BeagleBone by holding down BOOT switch");


// Event for device initialization
emitter.on('init',function(file, vid, pid, outEnd){

    // Connect to BeagleBone
    var device;
    while(device === undefined){
    device = usb.findByIds(vid, pid);
    }
    
    console.log(file+" =>");

    device.open();
    var interface = device.interface(1);    // Select interface 1 for BULK transfers

    windows = 0;
    if(platform == 'win32') windows = 1; 

    if(!windows){                // Not supported in Windows
        // Detach Kernel Driver
        if(interface.isKernelDriverActive()){
            interface.detachKernelDriver();
        }
    }

    interface.claim();

    // Code to initialize RNDIS device on Windows and OSX
    if(platform != 'linux'){
        var intf0 = device.interface(0);    // Select interface 0 for CONTROL transfer
        intf0.claim();

        var CONTROL_BUFFER_SIZE = 1025;  
        var rndis_init_size = 24;
        var rndis_set_size = 28;

        var rndis_buf = Buffer.alloc(CONTROL_BUFFER_SIZE);
        var init_msg = rndis_win.make_rndis_init();
        init_msg.copy(rndis_buf, 0, 0, rndis_init_size);


        // Windows Control Transfer
        // https://msdn.microsoft.com/en-us/library/aa447434.aspx
        // http://www.beyondlogic.org/usbnutshell/usb6.shtml

        var bmRequestType_send = 0x21; // USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE
        var bmRequestType_receive = 0xA1; // USB_DATA=DeviceToHost | USB_TYPE=CLASS | USB_RECIPIENT=INTERFACE

        // Sending rndis_init_msg (SEND_ENCAPSULATED_COMMAND)
        device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
            console.log(error);
        });

        // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
        device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
            console.log(data);
        });


        var set_msg = rndis_win.make_rndis_set();
        set_msg.copy(rndis_buf, 0, 0, rndis_set_size+4);

        // Send rndis_set_msg (SEND_ENCAPSULATED_COMMAND)
        device.controlTransfer(bmRequestType_send, 0, 0, 0, rndis_buf, function(error, data){
            console.log(error);
        });

        // Receive rndis_init_cmplt (GET_ENCAPSULATED_RESPONSE)
        device.controlTransfer(bmRequestType_receive, 0x01, 0, 0, CONTROL_BUFFER_SIZE, function(error, data){
            console.log(data);
        });

    }                      

    // Set endpoints for usb transfer
    inEndpoint = interface.endpoint(0x81);
    outEndpoint = interface.endpoint(outEnd);

    // Set endpoint transfer type
    inEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;
    outEndpoint.transferType = usb.LIBUSB_TRANSFER_TYPE_BULK;

    emitter.emit('getBOOTP', file);

});



// Event for receiving BOOTP
emitter.on('getBOOTP', function(file){

    var bootp_buf = Buffer.alloc(MAXBUF-rndisSize);     // Buffer for InEnd transfer

    inEndpoint.transfer(MAXBUF, function(error, data){

        if(!error){
            console.log('BOOTP received');

            if(file == 'spl'){

                data.copy(bootp_buf, 0, rndisSize, MAXBUF);

                ether = protocols.decode_ether(bootp_buf);      // Gets decoded ether packet data

                rndis = protocols.make_rndis(fullSize-rndisSize);   // Make RNDIS

                eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);    // Make ether2

                ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + bootpSize, 0); // Make ipv4

                udp = protocols.make_udp(bootpSize, BOOTPS, BOOTPC);    // Make udp

                bootreply = protocols.make_bootp(servername, file_spl, 1, ether.h_source, BB_ip, server_ip);    // Make BOOTP for reply

                buff = Buffer.concat([rndis, eth2, ip, udp, bootreply], fullSize);      // BOOT Reply

            }

            else{

                var udpUboot_buf = Buffer.alloc(udpSize);
                
                var spl_bootp_buf = Buffer.alloc(bootpSize);

                data.copy(udpUboot_buf, 0, rndisSize + etherSize + ipSize, MAXBUF);

                data.copy(spl_bootp_buf, 0, rndisSize + etherSize + ipSize + udpSize, MAXBUF);  

                var udpUboot = protocols.parse_udp(udpUboot_buf);       // parsed udp header

                var spl_bootp = protocols.parse_bootp(spl_bootp_buf);   // parsed bootp header

                rndis = protocols.make_rndis(fullSize - rndisSize);

                eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);

                ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + bootpSize, 0);

                udp = protocols.make_udp(bootpSize, udpUboot.udpDest, udpUboot.udpSrc);

                bootreply = protocols.make_bootp(servername, file_uboot, spl_bootp.xid, ether.h_source, BB_ip, server_ip);

                buff = Buffer.concat([rndis, eth2, ip, udp, bootreply], fullSize);
            }
        
            emitter.emit('sendBOOTP', file, buff);
        }

        else console.log("ERROR receiving BOOTP "+ error);    
    });
});



// Event for sending BOOTP reply
emitter.on('sendBOOTP', function(file, data){

    outEndpoint.transfer(data, function(error){
        if(!error){
            console.log("BOOTP reply done");
            emitter.emit('getARP', file);
        }
        else console.log("ERROR sending BOOTP "+ error);  
    });

});



// Event for receiving ARP request
emitter.on('getARP', function(file){

    inEndpoint.transfer(MAXBUF, function(error, data){

        if(!error){

            console.log('ARP request received');

            var arp_buf = Buffer.alloc(arp_Size);

            data.copy(arp_buf, 0, rndisSize + etherSize, rndisSize + etherSize + arp_Size);
        
            receivedARP = protocols.parse_arp(arp_buf);         // Parsed received ARP request

            // ARP response
            var arpResponse = protocols.make_arp(2, server_hwaddr, receivedARP.ip_dest, receivedARP.hw_source, receivedARP.ip_source );

            rndis = protocols.make_rndis(etherSize + arp_Size);

            eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHARPP);

            buff = Buffer.concat([rndis, eth2, arpResponse], rndisSize + etherSize + arp_Size);

            emitter.emit('sendARP', file, buff);
        }
        else console.log("ERROR receiving ARP request "+ error);  
    });

});

// Event for sending ARP response
emitter.on('sendARP', function(file, data){

    outEndpoint.transfer(data, function(error){

        if(!error){

            console.log('ARP response sent');

            emitter.emit('getTFTP', file);
        }
        else console.log("ERROR sending ARP request "+ error);  

    });
});


// Event for receiving SPL TFTP request
emitter.on('getTFTP', function(file){

    inEndpoint.transfer(MAXBUF, function(error, data){

        if(!error){

            var udpSPL_buf = Buffer.alloc(udpSize);

            data.copy(udpSPL_buf, 0, rndisSize + etherSize + ipSize, rndisSize + etherSize + ipSize + udpSize);
            
            udpSPL = protocols.parse_udp(udpSPL_buf);           // Received UDP packet for SPL tftp

            console.log('TFTP request received');

            emitter.emit('sendFile', file);
        }
        else console.log("ERROR receiving TFTP request "+ error);  
    });

});
////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////// File Transfer ////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////
emitter.on('sendFile', function(file){
    console.log(file+" transfer starts");

    fs.readFile("./bin/"+file, function(error, data){
    
        if(!error){
    
            var blocks = Math.ceil(data.length/512);         // Total number of blocks of file

            eth2 = protocols.make_ether2(ether.h_source, server_hwaddr, ETHIPP);    

            var start = 0;                                  // Source start for copy

            for(var i=1; i<=blocks; i++){                   // i is block number
                
                var blk_size = (i==blocks)? data.length - (blocks-1)*512 : 512;  // Different block size for last block

                var blk_data = Buffer.alloc(blk_size);
                data.copy(blk_data, 0, start, start + blk_size);                 // Copying data to block
                start += blk_size; 

                rndis = protocols.make_rndis(etherSize + ipSize + udpSize + tftpSize + blk_size);
                ip = protocols.make_ipv4(server_ip, BB_ip, IPUDP, 0, ipSize + udpSize + tftpSize + blk_size, 0);
                udp = protocols.make_udp(tftpSize + blk_size, udpSPL.udpDest, udpSPL.udpSrc);
                tftp = protocols.make_tftp(3, i);

                var file_data = Buffer.concat([rndis, eth2, ip, udp, tftp, blk_data], rndisSize + etherSize + ipSize + udpSize + tftpSize + blk_size);

                // Send SPL file data
                outEndpoint.transfer(file_data, function(error){});

                // Receive buffer back
                inEndpoint.transfer(MAXBUF, function(error, data){});
                
            }

            emitter.emit('transfer-done', file);
        }
        else console.log("Error reading "+file+" : "+error);
    });

});

emitter.on('transfer-done', function(file){
    console.log(file+" transfer complete");

    if(file=='spl'){

        setTimeout(function(){
        emitter.emit('init', 'uboot', SPLVID, SPLPID, 0x01);
        }, 2000);
    }

    else
        console.log('Ready for Flashing in a bit..');

});

emitter.emit('init', 'spl', ROMVID, ROMPID, 0x02);