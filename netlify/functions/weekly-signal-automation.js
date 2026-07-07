const { runWeeklyAutomation } = require("./_automation-core");

exports.handler = async () => {
  const result = await runWeeklyAutomation({ source: "scheduled-weekly" });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(result.status)
  };
};
