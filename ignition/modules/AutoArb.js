const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("TokenModule", (m) => {
  const DEPLOYER = m.getAccount(0)

  const AutoArb = m.contract(
    "AutoArb",
    [],
    { from: DEPLOYER }
  )

  return { AutoArb }
});