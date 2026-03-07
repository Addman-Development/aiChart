const packageJson = require("../package.json");

module.exports = () => {
  return (req, res, next) => {
    // version info endpoint
    if (req.path === "/update" && req.method === "GET") {
      return res.status(200).send({
        upToDate: true,
        version: packageJson.version,
      });
    }
    next();
  };
};
