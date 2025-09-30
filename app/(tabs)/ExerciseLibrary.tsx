// app/(tabs)/ExerciseLibrary.tsx
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, Linking, Alert } from 'react-native';

type Exercise = {
  name: string;
  category: 'ทั้งหมด'|'หน้าอก'|'หลัง'|'ขา'|'ไหล่'|'แขน'|'แกนกลาง'|'คาร์ดิโอ';
  difficulty: 'beginner'|'intermediate'|'advanced';
  equipment: string[]; // barbell/dumbbell/cable/kettlebell/bodyweight
  target: string[];
  aiTips: string[];
  rating: number; // 1-5
  video?: string;
};

const EXS: Exercise[] = [
  { name: 'Barbell Bench Press', category: 'หน้าอก', difficulty: 'intermediate', equipment: ['barbell'], target:['อก','ไตรเซ็ปส์','ไหล่หน้า'], aiTips:['สะบักแน่น','แตะอกแล้วดัน','รับแรงผ่านเท้า'], rating: 4.8, video:'https://www.youtube.com/watch?v=gRVjAtPip0Y' },
  { name: 'Bulgarian Split Squat', category: 'ขา', difficulty: 'intermediate', equipment: ['dumbbell','bodyweight'], target:['หน้าขา','ก้น'], aiTips:['ลำตัวตั้ง','ลงช้า','คุมทรง'], rating: 4.6, video:'https://www.youtube.com/watch?v=2C-uNgKwPLE' },
  { name: 'Face Pull', category: 'ไหล่', difficulty: 'beginner', equipment: ['cable'], target:['ไหล่หลัง','สะบัก'], aiTips:['ศอกสูงเล็กน้อย','ดึงสู่หน้าผาก'], rating: 4.7, video:'https://www.youtube.com/watch?v=rep-qVOkqgk' },
  { name: 'Kettlebell Swing', category: 'คาร์ดิโอ', difficulty: 'intermediate', equipment: ['kettlebell'], target:['หลังขา','ก้น','แกนกลาง'], aiTips:['ฮิปฮินจ์ ไม่ใช่ยกไหล่','ระเบิดแรงที่สะโพก'], rating: 4.5, video:'https://www.youtube.com/watch?v=6u1ZVfVwUuQ' },
  { name: 'Dead Bug', category: 'แกนกลาง', difficulty: 'beginner', equipment: ['bodyweight'], target:['แกนกลาง'], aiTips:['หลังแนบพื้น','หายใจปกติ'], rating: 4.4, video:'https://www.youtube.com/watch?v=gBY8dR6mDJk' },
  { name: 'Barbell Row', category: 'หลัง', difficulty: 'intermediate', equipment: ['barbell'], target:['หลังกลาง','lat'], aiTips:['ลำตัวนิ่ง','ดึงศอกชิดลำตัว'], rating: 4.6, video:'https://www.youtube.com/watch?v=kBWAon7ItDw' },
];

const CATS = ['ทั้งหมด','หน้าอก','หลัง','ขา','ไหล่','แขน','แกนกลาง','คาร์ดิโอ'] as const;
const DIFF = ['beginner','intermediate','advanced'] as const;
const EQUIP = ['barbell','dumbbell','cable','kettlebell','bodyweight'] as const;

export default function ExerciseLibrary() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<(typeof CATS)[number]>('ทั้งหมด');
  const [dif, setDif] = useState<(typeof DIFF)[number] | null>(null);
  const [eq, setEq] = useState<(typeof EQUIP)[number] | null>(null);

  const list = useMemo(() => {
    return EXS.filter(x => (
      (!q || x.name.toLowerCase().includes(q.toLowerCase())) &&
      (cat === 'ทั้งหมด' || x.category === cat) &&
      (!dif || x.difficulty === dif) &&
      (!eq || x.equipment.includes(eq))
    ));
  }, [q, cat, dif, eq]);

  return (
    <ScrollView contentContainerStyle={{ padding:16, paddingBottom:32 }}>
      <Text style={styles.title}>คลังท่าออกกำลังกาย</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="ค้นหาท่า..." style={styles.input} />

      <Text style={styles.section}>หมวด</Text>
      <View style={styles.rowWrap}>
        {CATS.map(c => (
          <TouchableOpacity key={c} style={[styles.pill, cat===c && styles.pillActive]} onPress={()=>setCat(c)}>
            <Text style={[styles.pillText, cat===c && styles.pillTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>ระดับ</Text>
      <View style={styles.rowWrap}>
        {DIFF.map(d => (
          <TouchableOpacity key={d} style={[styles.pill, dif===d && styles.pillActive]} onPress={()=>setDif(dif===d?null:d)}>
            <Text style={[styles.pillText, dif===d && styles.pillTextActive]}>{d}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>อุปกรณ์</Text>
      <View style={styles.rowWrap}>
        {EQUIP.map(e => (
          <TouchableOpacity key={e} style={[styles.pill, eq===e && styles.pillActive]} onPress={()=>setEq(eq===e?null:e)}>
            <Text style={[styles.pillText, eq===e && styles.pillTextActive]}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>ผลลัพธ์</Text>
      {list.map((x) => (
        <View key={x.name} style={styles.card}>
          <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
            <Text style={styles.name}>{x.name}</Text>
            <Text style={styles.rating}>★ {x.rating.toFixed(1)}</Text>
          </View>
          <Text style={styles.meta}>{x.category} • {x.difficulty} • {x.equipment.join(', ')}</Text>
          <Text style={styles.meta}>กล้ามเนื้อหลัก: {x.target.join(', ')}</Text>
          <View style={styles.tipBox}>
            <Text style={styles.tipTitle}>AI Tips</Text>
            {x.aiTips.map((t,i)=>(<Text key={i} style={styles.tip}>• {t}</Text>))}
          </View>
          {!!x.video && (
            <TouchableOpacity style={styles.linkBtn} onPress={()=>Linking.openURL(x.video!).catch(()=>Alert.alert('เปิดลิงก์ไม่ได้'))}>
              <Text style={styles.linkText}>วิดีโอสาธิต</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {list.length === 0 && <Text style={styles.meta}>ไม่พบผลลัพธ์</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title:{ fontSize:20, fontWeight:'900', color:'#111', marginBottom:10 },
  input:{ borderWidth:1, borderColor:'#e5e7eb', borderRadius:10, padding:10, backgroundColor:'#fff', marginBottom:10 },
  section:{ marginTop:12, marginBottom:6, fontWeight:'800', color:'#111' },
  rowWrap:{ flexDirection:'row', flexWrap:'wrap', gap:8 },
  pill:{ paddingHorizontal:12, paddingVertical:8, borderRadius:999, backgroundColor:'#f3f4f6', borderWidth:1, borderColor:'#e5e7eb' },
  pillActive:{ backgroundColor:'#8b5cf6', borderColor:'#7c3aed' },
  pillText:{ fontWeight:'700', color:'#374151' },
  pillTextActive:{ color:'#fff' },
  card:{ backgroundColor:'#fff', borderWidth:1, borderColor:'#e5e7eb', borderRadius:12, padding:12, marginBottom:10 },
  name:{ fontWeight:'900', color:'#111' },
  rating:{ fontWeight:'800', color:'#f59e0b' },
  meta:{ color:'#6b7280', marginTop:2 },
  tipBox:{ marginTop:8, borderWidth:1, borderColor:'#c7d2fe', backgroundColor:'#eef2ff', borderRadius:10, padding:10 },
  tipTitle:{ fontWeight:'800', color:'#3730a3', marginBottom:4 },
  tip:{ color:'#3730a3' },
  linkBtn:{ alignSelf:'flex-start', marginTop:8, paddingVertical:6, paddingHorizontal:10, borderWidth:1, borderColor:'#c7d2fe', backgroundColor:'#eef2ff', borderRadius:10 },
  linkText:{ color:'#3730a3', fontWeight:'800' },
});

