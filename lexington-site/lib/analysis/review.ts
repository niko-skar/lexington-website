// The written review at the top of the Analysis tab (Niko, 7 Nov 2026: "do your own analysis of how its going"):
// Claude's reading of the books on that day, in plain words. The numbers under it keep themselves up to date; this
// is written again when he asks for a fresh one.

export interface ReviewPoint {
  title: string;
  text: string;
}

export const REVIEW: { date: string; points: ReviewPoint[] } = {
  date: "2026-11-07",
  points: [
    {
      title: "GH₵ 5.9 million spent so far",
      text: "From the first works in November 2025 to now. Steel is the biggest cost (GH₵ 2.24M, 38%), then concrete (GH₵ 1.18M, 20%) and labour (GH₵ 1.16M, 20%): those three are three quarters of everything.",
    },
    {
      title: "The foundations took more than half",
      text: "GH₵ 3.07M went on the foundations and basement (February to May: the digging, the raft, the basement walls). The floors above cost far less each: the ground floor GH₵ 0.73M, the 1st floor GH₵ 1.44M, the 2nd floor GH₵ 0.53M so far.",
    },
    {
      title: "A working month costs GH₵ 0.6 to 1.1 million",
      text: "June GH₵ 625k, July GH₵ 673k, October GH₵ 1.09M, about 60% of it steel and concrete. Leo's usual GH₵ 50k a week is about GH₵ 215k a month, so each floor needs a lump sum from Leo or buyers' money on top. Plan the steel (about 27 tons, GH₵ 300k) and the slab's concrete (about 100 m³, GH₵ 150k) for when that money lands.",
    },
    {
      title: "Since 28 September, money in and out are about even",
      text: "In: GH₵ 1.35M (Leo GH₵ 1.21M, buyers GH₵ 135,500). Out: GH₵ 1.28M. You had GH₵ 90,320 on 5 November. Next from buyers, on your cash plan: Gyasi's second US$10,000 on 9 November, and Ibrahim's US$2,000 a month from 28 November.",
    },
    {
      title: "Prices are up 9 to 16% this year",
      text: "Steel GH₵ 9,575 to 10,991 a ton since February (+15%), plywood 458 to 525 a sheet since April (+15%, now 21mm marine), cement 105 to 122 a bag (+16%), 2x4 99 to 108 (+9%). Concrete hasn't moved (GH₵ 1,514 a m³). Steel matters most: GH₵ 1,000 more a ton is about GH₵ 27k more a floor.",
    },
    {
      title: "Check these in QuickBooks",
      text: "Afranie's 6 tons of steel (GH₵ 56,000) is in twice: as a bill paid on 15 and 18 May, and as cash on 2 May (Expense 361). Stairps' props (GH₵ 20,000) were paid by bank on 1 October and also have an open bill for October (BILL-0001). And nothing at all is recorded from 5 August to 28 September: if money went out then, it isn't in the books.",
    },
    {
      title: "What you've bought, counted",
      text: "910 pieces of 2x4, 300 sheets of plywood, 78 wawa boards, 475 bags of cement, 664 m³ of concrete and about 211 tons of steel (6 of them maybe counted twice, above). The Materials tab has every item, and what each purchase was.",
    },
  ],
};
