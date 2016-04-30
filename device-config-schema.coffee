module.exports = {
  title: "pimatic-orvibo device config schema"
  OrviboOutlet: {
    title: "Orvibo outlet"
    description: "Orvibo wifi controlled outlet"
    type: "object"
    extensions: ["xConfirm", "xOnLabel", "xOffLabel", "xLink"]
    properties:
      ip:
        description: "IP address of the outlet"
        type: "string"
      mac:
        description: "MAC address of the outlet"
        type: "string"
      password:
        description: "Remote password for the outlet (if locked)(not yet supported)"
        type: "string"
        default: ""
      interval:
        description: "Polling interval for outlet state in seconds"
        type: "number"
        default: 60
  }
}