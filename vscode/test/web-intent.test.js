"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),{requested}=require("../web-intent");
test("explicit and live weather requests activate Web, ordinary questions and refusals do not",()=>{
 for(const text of ["Найди в интернете ABAP benchmarks","Проверь актуальные цены","Search the web for ABAP","Пошукай в інтернеті","Поищи в сети","Загугли эту ошибку","Какая погода сейчас в Ромнах?","Погода сегодня в Киеве","Current weather in London","Weather today in Berlin"])assert.equal(requested(text),true,text);
 for(const text of ["список методов","видишь ZVERTEX_DEBUG_LAB?","посмотри последний лог","Какая погода в Ромнах обычно в ноябре?","Не ищи в интернете, ответь по коду","Не ищи в интернете: какая погода сейчас в Ромнах?","Do not search the web","Без интернета проверь код"])assert.equal(requested(text),false,text);
});
