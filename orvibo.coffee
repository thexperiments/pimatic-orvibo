# #Plugin template

# This is an plugin template and mini tutorial for creating pimatic plugins. It will explain the 
# basics of how the plugin system works and how a plugin should look like.

# ##The plugin code
# Your plugin must export a single function, that takes one argument and returns a instance of
# your plugin class. The parameter is an environment object containing all pimatic related functions
# and classes. See the [startup.coffee](http://sweetpi.de/pimatic/docs/startup.html) for details.
module.exports = (env) ->

  # ###require modules included in pimatic
  # To require modules that are included in pimatic use `env.require`. For available packages take 
  # a look at the dependencies section in pimatics package.json

  # Require the  bluebird promise library
  Promise = env.require 'bluebird'
  _ = env.require 'lodash'

  dgram = env.require 'dgram'
  os = require 'os'

  # Include you own dependencies with nodes global require function:
  #  
  #     someThing = require 'someThing'
  #  

  OrviboNode = require('./orvibo-node.js')(Promise)

  class Orvibo extends env.plugins.Plugin

    # ####init()
    # The `init` function is called by the framework to ask your plugin to initialise.
    #  
    # #####params:
    #  * `app` is the [express] instance the framework is using.
    #  * `framework` the framework itself
    #  * `config` the properties the user specified as config for your plugin in the `plugins` 
    #     section of the config.json file 

    init: (app, @framework, @config) =>
      # get the device config schemas
      deviceConfigDef = require("./device-config-schema")
      env.logger.info("Starting pimatic-orvibo plugin")

      @framework.deviceManager.registerDeviceClass("OrviboOutlet", {
        configDef: deviceConfigDef.OrviboOutlet,
        createCallback: (config, lastState) =>
          return new OrviboOutlet(config, @, lastState)
      })

      @framework.deviceManager.on('discover', (eventData) =>
        outletsFound = {}
        lastId = ""

        OrviboNode.on 'deviceDiscovered', cb = (messageIp, messageMac, messageDeviceIdentifierASCII) =>
          unless not messageMac? or messageMac.length is 0 or _.has outletsFound, messageMac
            outletsFound[messageMac] = messageIp
            lastId = @_generateDeviceId "orvibo", lastId
            config =
              class: 'OrviboOutlet'
              id: lastId
              name: lastId
              ip: messageIp
              mac: messageMac

            @framework.deviceManager.discoveredDevice(
              'pimatic-orvibo', "#{lastId}@#{messageIp}", config
            )

        setTimeout(=>
          OrviboNode.removeListener 'deviceDiscovered', cb
        , eventData.time || 20000
        )

        # ping all devices in each net:
        @enumerateNetworkInterfaces().forEach( (networkInterface) =>
          basePart = networkInterface.address.match(/([0-9]+\.[0-9]+\.[0-9]+\.)[0-9]+/)[1]

          @framework.deviceManager.discoverMessage(
            'pimatic-orvibo', "Scanning #{basePart}0/24 for Orvibo outlets"
          )
          OrviboNode.discover "#{basePart}255"
        )
      )

    # get all ip4 non local networks with /24 submask
    enumerateNetworkInterfaces: () ->
      result = []
      networkInterfaces = os.networkInterfaces()
      Object.keys(networkInterfaces).forEach( (name) ->
        networkInterfaces[name].forEach (networkInterface) ->
          if 'IPv4' isnt networkInterface.family or networkInterface.internal isnt false
            # skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
            return
          if networkInterface.netmask isnt "255.255.255.0"
            return
          result.push
            name: name
            address: networkInterface.address
        return
      )
      if result.length is 0
        # fallback to global broadcast
        result.push
          name: '255.255.255.255/32'
          address: '255.255.255.255'
      return result

    _generateDeviceId: (prefix, lastId = null) ->
      start = 1
      if lastId?
        m = lastId.match /.*-([0-9]+)$/
        start = +m[1] + 1 if m? and m.length is 2
      for x in [start...1000] by 1
        result = "#{prefix}-#{x}"
        matched = @framework.deviceManager.devicesConfig.some (element, iterator) ->
          element.id is result
        return result if not matched

  class OrviboOutlet extends env.devices.PowerSwitch
    #
    constructor: (@config, @plugin, lastState) ->
      @name = @config.name
      @id = @config.id
      @ip = @config.ip
      @mac = (@config.mac || "").toLowerCase().trim()
      @interval = 1000 * @config.interval

      #as we are subscribed the socket will also notify us about all powerstate changes
      OrviboNode.on 'changePowerStateSuccessful', (successIp, successMac, successState) =>
        if successIp = @ip && successMac == @mac
          if @_state != successState
            @_setState successState
      
      updateValue = =>
        if @config.interval > 0
          @getState().finally( =>
            @timeoutId = setTimeout(updateValue, @interval) 
          )
      
      super()
      updateValue()

    destroy: () ->
      clearTimeout(@timeoutId) if @timeoutId?
      super()

    getState: () ->
      return OrviboNode.getPowerState(@ip, @mac).then (state) =>
        @_setState(state)
        return Promise.resolve(state)

    changeStateTo: (state) ->
      return OrviboNode.changePowerState(@ip, @mac, state).then () =>
        @_setState(state)
        

  # ###Finally
  # Create a instance of my plugin
  myOrvibo = new Orvibo
  # and return it to the framework.
  return myOrvibo
