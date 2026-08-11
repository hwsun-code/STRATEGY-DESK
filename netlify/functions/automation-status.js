const { json } = require("./_riskdesk-common");
const { automationStatus } = require("./_automation-core");
const researchSignals = require("./research-signals");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.queryStringParameters?.research === "1" || /research-signals/i.test(event.path || "")) {
    return researchSignals.handler(event);
  }
  return json(200, await automationStatus());
};
