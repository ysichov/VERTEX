"use strict";
// Explicit web requests opt into billed search; ordinary questions stay ordinary chat.
function requested(text){
  const value=String(text||"").toLowerCase();
  if(/(?:не\s+(?:ищи|искать|шукай|шукати|используй\s+(?:веб|интернет))|без\s+(?:веб|интернет)|do\s+not\s+(?:search|browse)|don['’]t\s+(?:search|browse)|without\s+(?:web|internet))/u.test(value))return false;
  return /(?:погугли|загугли|google it|web search)/u.test(value) || /(?:найди|найти|поищи|ищи|пошукай|знайди|шукай|search|browse|look\s+up|find)[\s\S]{0,140}(?:интернет|інтернет|веб|онлайн|в\s+сети|\bweb\b|\bonline\b|\binternet\b)/u.test(value)
    || /(?:проверь|проверить|перевір|check|verify)[\s\S]{0,100}(?:актуальн|latest|current|up.to.date)/u.test(value)
    || /(?:в\s+(?:интернете|інтернеті|вебе)|on\s+the\s+web)[\s\S]{0,80}(?:найди|поищи|знайди|search|find)/u.test(value);
}
module.exports={requested};
