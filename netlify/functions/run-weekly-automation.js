const { json } = require("./_riskdesk-common");
const { runWeeklyAutomation } = require("./_automation-core");

exports.handler = async event => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return json(405, { error: "Method not allowed" });
  }
  const result = await runWeeklyAutomation({ source: "manual-api" });
  return json(200, result);
};
