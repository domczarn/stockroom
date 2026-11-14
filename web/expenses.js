'use strict';
let expenseRemoval=null;
function removeExpenseFrom(data,index,snapshot,kind='expense'){
 const field=kind==='sale'?'sales':'expenses',archive=kind==='sale'?'removedSales':'removedExpenses';
 if(!Number.isInteger(index)||index<0||JSON.stringify(data[field][index])!==snapshot)throw Error('This entry changed. Close this window and try again.');
 if((data[archive]||[]).length>=2000)throw Error('The removed-entry archive is full.');
 const next=cloneWorkspace(data),row=next[field].splice(index,1)[0];
 (next[archive] ||= []).push({id:newId(),removedAt:new Date().toISOString(),row});
 return next;
}
function restoreExpenseFrom(data,id,kind='expense'){
 const field=kind==='sale'?'sales':'expenses',archive=kind==='sale'?'removedSales':'removedExpenses';
 const index=(data[archive]||[]).findIndex(entry=>entry.id===id);
 if(index<0)throw Error('This entry has already been restored.');
 if(data[field].length>=2000)throw Error('The workspace entry limit has been reached.');
 const next=cloneWorkspace(data);next[field].push(next[archive].splice(index,1)[0].row);return next;
}
function removedExpensesView(kind='expense'){
 const archive=kind==='sale'?'removedSales':'removedExpenses',label=kind==='sale'?'sales':'expenses';
 const rows=db[archive]||[];if(!rows.length)return '';
 return '<details class="panel removed-expenses"><summary>Removed '+label+' ('+rows.length+')</summary><p class="footnote">Excluded from profit and reports. Restore an entry if it was removed by mistake.</p>'+rows.slice().reverse().map(entry=>'<div class="removed-expense"><div><strong>'+esc(entry.row[0])+'</strong><small>'+gbp(entry.row[1])+' · Removed '+esc(new Date(entry.removedAt).toLocaleDateString('en-GB'))+'</small></div><button class="secondary" data-kind="'+kind+'" data-expense-restore="'+esc(entry.id)+'" '+(isReadOnly()?'disabled':'')+'>Restore</button></div>').join('')+'</details>';
}
document.addEventListener('click',async event=>{
 const remove=event.target.closest('[data-expense-remove]'),restore=event.target.closest('[data-expense-restore]');
 if((!remove&&!restore)||isReadOnly())return;
 if(remove){const kind=remove.dataset.kind==='sale'?'sale':'expense',field=kind==='sale'?'sales':'expenses';const index=Number(remove.dataset.expenseRemove),row=db[field][index];if(!row)return;
 expenseRemoval={kind,index,snapshot:JSON.stringify(row)};$('expenseRemoveTitle').textContent=kind==='sale'?'Remove sale?':'Remove expense?';$('confirmExpenseRemove').textContent=kind==='sale'?'Remove sale':'Remove expense';$('expenseRemoveExplanation').textContent='This entry will be excluded from business totals and reports. You can restore it from Removed '+(kind==='sale'?'sales in Activity.':'expenses.');$('expenseRemoveName').textContent=row[0];$('expenseRemoveAmount').textContent=gbp(row[1]);$('expenseRemoveError').textContent='';openPanel($('expenseRemoveDialog'));return;}
 restore.disabled=true;try{await persist(restoreExpenseFrom(db,restore.dataset.expenseRestore,restore.dataset.kind));toast('Entry restored. Profit and reports updated.');}catch(error){toast(error.message);restore.disabled=false;}
});
document.addEventListener('DOMContentLoaded',()=>{
 $('confirmExpenseRemove').onclick=async()=>{
 if(!expenseRemoval||isReadOnly())return;
 const button=$('confirmExpenseRemove');button.disabled=true;
 try{await persist(removeExpenseFrom(db,expenseRemoval.index,expenseRemoval.snapshot,expenseRemoval.kind));expenseRemoval=null;closePanel($('expenseRemoveDialog'));toast('Entry removed. It can be restored from the removed entries list.');}
 catch(error){$('expenseRemoveError').textContent=error.message;}finally{button.disabled=false;}
 };
});
