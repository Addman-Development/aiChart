const PushSubscriptionController = require("../controllers/PushSubscriptionController");
const verifyToken = require("../modules/verifyToken");
const pushService = require("../modules/pushService");

module.exports = (app) => {
  const pushSubscriptionController = new PushSubscriptionController();

  /*
  ** Public: expose this deployment's VAPID public key so the browser can
  ** subscribe. The public key is not a secret. Always responds 200 with
  ** publicKey:null when push isn't configured, so the client treats the feature
  ** as unavailable WITHOUT the browser logging a console 404 for a feature that
  ** is intentionally disabled on this deployment.
  */
  app.get("/push/vapid", (req, res) => {
    return res.status(200).send({ publicKey: pushService.getPublicKey() || null });
  });
  // --------------------------------------

  /*
  ** Store/refresh the current user's push subscription for this device.
  */
  app.post("/push/subscription", verifyToken, (req, res) => {
    return pushSubscriptionController.subscribe(req.user.id, req.body || {})
      .then((subscription) => res.status(200).send({ id: subscription.id }))
      .catch((error) => {
        if (error.message === "400") return res.status(400).send({ message: "Invalid subscription" });
        return res.status(400).send(error);
      });
  });
  // --------------------------------------

  /*
  ** Remove the current user's push subscription for this device.
  */
  app.delete("/push/subscription", verifyToken, (req, res) => {
    return pushSubscriptionController.unsubscribe(req.user.id, req.body && req.body.endpoint)
      .then((result) => res.status(200).send(result))
      .catch((error) => {
        if (error.message === "400") return res.status(400).send({ message: "Missing endpoint" });
        return res.status(400).send(error);
      });
  });
  // --------------------------------------

  return (req, res, next) => {
    next();
  };
};
