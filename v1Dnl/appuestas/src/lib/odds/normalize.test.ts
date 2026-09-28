import { normalizeOddsEvent, type OddsApiEvent } from "./normalize";

const sampleEvent: OddsApiEvent = {
  id: "94d0c4d70e74a3ca8f70abe5a0859ea1",
  sport_key: "baseball_mlb",
  sport_title: "MLB",
  commence_time: "2026-09-23T22:36:00Z",
  home_team: "Baltimore Orioles",
  away_team: "Toronto Blue Jays",
  bookmakers: [
    {
      key: "fanduel",
      title: "FanDuel",
      markets: [
        {
          key: "h2h_3_way_1st_3_innings",
          lastUpdate: "2026-09-23T22:43:51Z",
          outcomes: [
            {
              name: "Baltimore Orioles",
              price: 2.0,
            },
            {
              name: "Toronto Blue Jays",
              price: 3.85,
            },
            {
              name: "Draw",
              price: 3.3,
            },
          ],
        },
        {
          key: "h2h_3_way_1st_5_innings",
          lastUpdate: "2026-09-23T22:43:51Z",
          outcomes: [
            {
              name: "Baltimore Orioles",
              price: 1.85,
            },
            {
              name: "Toronto Blue Jays",
              price: 2.94,
            },
            {
              name: "Draw",
              price: 4.9,
            },
          ],
        },
      ],
    },
  ],
};

const result = normalizeOddsEvent(sampleEvent);

console.log(JSON.stringify(result, null, 2));