const { json } = require("./_riskdesk-common");
const { automationStatus } = require("./_automation-core");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  return json(200, await automationStatus());
};
