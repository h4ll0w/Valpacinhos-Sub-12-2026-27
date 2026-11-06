-- Update EmblemaUrl for teams with icons
-- Run in Supabase SQL Editor

UPDATE tblequipas SET "EmblemaUrl" = '/icon/1.jpg'  WHERE "IdEquipa" = 1;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/2.jpg'  WHERE "IdEquipa" = 2;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/3.png'  WHERE "IdEquipa" = 3;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/4.jpg'  WHERE "IdEquipa" = 4;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/5.jpg'  WHERE "IdEquipa" = 5;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/6.png'  WHERE "IdEquipa" = 6;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/7.png'  WHERE "IdEquipa" = 7;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/8.jpg'  WHERE "IdEquipa" = 8;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/9.jpg'  WHERE "IdEquipa" = 9;
-- 10 missing
UPDATE tblequipas SET "EmblemaUrl" = '/icon/11.png' WHERE "IdEquipa" = 11;
-- 12 missing
UPDATE tblequipas SET "EmblemaUrl" = '/icon/13.png' WHERE "IdEquipa" = 13;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/14.jpg' WHERE "IdEquipa" = 14;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/15.jpg' WHERE "IdEquipa" = 15;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/16.jpg' WHERE "IdEquipa" = 16;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/17.jpg' WHERE "IdEquipa" = 17;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/18.jpg' WHERE "IdEquipa" = 18;
-- 19 missing
-- 20 missing
UPDATE tblequipas SET "EmblemaUrl" = '/icon/21.jpg' WHERE "IdEquipa" = 21;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/22.png' WHERE "IdEquipa" = 22;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/23.jpg' WHERE "IdEquipa" = 23;
-- 24 missing
UPDATE tblequipas SET "EmblemaUrl" = '/icon/25.jpg' WHERE "IdEquipa" = 25;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/26.png' WHERE "IdEquipa" = 26;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/27.jpg' WHERE "IdEquipa" = 27;
UPDATE tblequipas SET "EmblemaUrl" = '/icon/28.jpg' WHERE "IdEquipa" = 28;

-- Verify
SELECT "IdEquipa", "NmEquipa", "EmblemaUrl" FROM tblequipas ORDER BY "IdEquipa";
