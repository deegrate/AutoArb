const { expect } = require("chai")

describe("AutoArb", () => {
  let owner
  let arbitrage

  beforeEach(async () => {
    [owner] = await ethers.getSigners()

    arbitrage = await hre.ethers.deployContract("AutoArb")
    await arbitrage.waitForDeployment()
  })

  describe("Deployment", () => {
    it("Sets the owner", async () => {
      expect(await arbitrage.owner()).to.equal(await owner.getAddress())
    })
  })

  describe("Trading", () => {

    /**
     * Feel Free to customize and add in your own unit testing here.
     */

  })
})
