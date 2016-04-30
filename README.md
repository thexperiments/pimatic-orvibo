Pimatic Orvibo plugin
=======================

This plugin adds the functionality to controll orvibo s20 sockets via pimatic (udp)

In order to use the s20 wifi socket you have to know the ip and mac address of the device.

Example config.json entries:
```json
  "plugins": [
    {
      "plugin": "orvibo"
    }
  ],

  {
      "id": "orvibo-test",
      "name": "My WifFi Outlet",
      "class": "OrviboOutlet",
      "ip": "192.168.XXX.XXX",
      "mac": "deadbeefbeef"
    },
  ]
```