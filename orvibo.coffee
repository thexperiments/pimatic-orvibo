# #Plugin template

# This is an plugin template and mini tutorial for creating pimatic plugins. It will explain the 
# basics of how the plugin system works and how a plugin should look like.

# ##The plugin code
# Your plugin must export a single function, that takes one argument and returns a instance of
# your plugin class. The parameter is an envirement object containing all pimatic related functions
# and classes. See the [startup.coffee](http://sweetpi.de/pimatic/docs/startup.html) for details.
module.exports = (env) ->

  # ###require modules included in pimatic
  # To require modules that are included in pimatic use `env.require`. For available packages take 
  # a look at the dependencies section in pimatics package.json

  # Require the  bluebird promise library
  Promise = env.require 'bluebird'

  # Require the [cassert library](https://github.com/rhoot/cassert).
  assert = env.require 'cassert'

  # Require dgram for UDP communication
  dgram = env.require 'dgram'

  # Include you own depencies with nodes global require function:
  #  
  #     someThing = require 'someThing'
  #  

  OrviboNode = require './orvibo-node.js'

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


  class OrviboOutlet extends env.devices.PowerSwitch
    #
    constructor: (@config, @plugin, lastState) ->
      @name = @config.name
      @id = @config.id
      @ip = @config.ip
      @mac = @config.mac
      @interval = 1000 * @config.interval

      #as we are sobscribed the socket will also notify us about all powerstate changes
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
        return Promise.resolve()

    changeStateTo: (state) ->
      return OrviboNode.changePowerState(@ip, @mac, state).then () =>
        @_setState(state)
        

  # ###Finally
  # Create a instance of my plugin
  myOrvibo = new Orvibo
  # and return it to the framework.
  return myOrvibo